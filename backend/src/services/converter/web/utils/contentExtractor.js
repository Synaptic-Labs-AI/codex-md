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
        // Helper function to get text density
        const getTextDensity = (element) => {
          if (!element) return 0;
          const text = element.textContent || '';
          const html = element.innerHTML || '';
          return text.length / (html.length || 1);
        };

        // Helper function to get content value
        const getContentValue = (element) => {
          if (!element) return 0;
          
          const text = element.textContent || '';
          const words = text.split(/\s+/).filter(Boolean);
          
          // Skip empty or very short elements
          if (words.length < 20) return 0;
          
          // Count various content indicators
          const paragraphs = element.querySelectorAll('p');
          const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
          const lists = element.querySelectorAll('ul, ol');
          const codeBlocks = element.querySelectorAll('pre, code');
          const links = element.querySelectorAll('a');
          const images = element.querySelectorAll('img');
          const tables = element.querySelectorAll('table');
          const divs = element.querySelectorAll('div > div'); // Nested divs often contain content
          
          // Calculate density scores
          const textDensity = getTextDensity(element);
          const linkDensity = Array.from(links).reduce((sum, link) =>
            sum + (link.textContent || '').length, 0) / (text.length || 1);
          
          // Calculate base score
          let score = 0;
          score += words.length * 0.3;
          score += paragraphs.length * 15;
          score += headings.length * 20;
          score += lists.length * 10;
          score += codeBlocks.length * 15;
          score += images.length * 5;
          score += tables.length * 15;
          score += divs.length * 2;
          score += textDensity * 100;
          score -= linkDensity * 50;
          
          // Semantic meaning bonuses - prioritize modern semantic HTML5 elements
          if (element.tagName === 'ARTICLE' || element.closest('article')) score += 150;
          if (element.tagName === 'MAIN' || element.closest('main')) score += 150;
          if (element.getAttribute('role') === 'main') score += 100;
          if (element.tagName === 'SECTION' || element.closest('section')) score += 50;
          
          // Content-related class and ID bonuses - expanded for modern websites
          const className = element.className || '';
          const idName = element.id || '';
          const attributeText = className + ' ' + idName;
          
          if (/content|article|post|entry|body|text|blog/i.test(attributeText)) score += 50;
          if (/main|primary|central/i.test(attributeText)) score += 40;
          if (/container|wrapper|inner/i.test(attributeText)) score += 30;
          
          // Penalize navigation, header, footer areas
          if (/nav|header|footer|menu|sidebar|comment|ad|banner|promo/i.test(attributeText) ||
              /nav|header|footer/i.test(element.tagName)) {
            score -= 200;
          }
          
          // Bonus for deep article structure
          if (element.querySelectorAll('article p').length > 3) score += 100;
          if (element.querySelectorAll('section p').length > 3) score += 50;
          
          // Bonus for structured content
          if (headings.length > 0 && paragraphs.length > headings.length * 2) score += 100;
          
          return score;
        };

        // Try specific selectors first for common website layouts
        const commonSelectors = [
          'main[role="main"]',
          'div[role="main"]',
          'article',
          'main',
          '.main-content',
          '.article-content',
          '.post-content',
          '.entry-content',
          '.content-main',
          '#content',
          '.content'
        ];
        
        for (const selector of commonSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim().length > 200) {
            const score = getContentValue(element);
            if (score > 100) {
              return {
                content: element.outerHTML,
                score: score
              };
            }
          }
        }

        // If no good match with common selectors, scan all elements
        const allElements = document.querySelectorAll('body *');
        let bestElement = null;
        let bestScore = 0;

        allElements.forEach(element => {
          const score = getContentValue(element);
          if (score > bestScore) {
            bestElement = element;
            bestScore = score;
          }
        });

        // Return the best content found
        return {
          content: bestElement ? bestElement.outerHTML : document.body.outerHTML,
          score: bestScore
        };
      });
    } catch (error) {
      console.error('Error finding main content:', error);
      return { content: '', score: 0 };
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

      // Try enhanced content detection first
      try {
        const result = await this.findMainContent(page);
        if (result.content && result.score > 50) {
          content = result.content;
          score = result.score;
          console.log(`Found main content with score: ${score}`);
        }
      } catch (e) {
        console.error('Error in main content detection:', e);
      }

      // If no good content found, try fallback approaches
      if (!content || content.length < 1000 || score < 30) {
        console.log('Content too short or low quality, trying fallback strategies');
        
        // Try to get content from article or main elements
        try {
          const articleContent = await page.evaluate(() => {
            const article = document.querySelector('article');
            if (article && article.textContent.length > 500) {
              return article.outerHTML;
            }
            
            const main = document.querySelector('main');
            if (main && main.textContent.length > 500) {
              return main.outerHTML;
            }
            
            return null;
          });
          
          if (articleContent) {
            console.log('Found content in article/main element');
            content = articleContent;
          } else {
            console.log('No article/main content found, using body content');
            content = cleanedRawHtml;
          }
        } catch (fallbackError) {
          console.error('Error in fallback content extraction:', fallbackError);
          content = cleanedRawHtml;
        }
      }
      
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
      
      // First check if it's an SPA
      const isSpa = await page.evaluate(() => {
        // Check for common SPA frameworks
        return !!(
          window.angular ||
          window.React ||
          window.Vue ||
          document.querySelector('[ng-app]') ||
          document.querySelector('[data-reactroot]') ||
          document.querySelector('#app') ||
          document.querySelector('#root')
        );
      });
      
      if (isSpa) {
        console.log('Detected SPA, waiting for content to stabilize...');
        
        // Wait for network to be idle
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 5000 }).catch(() => {
          console.log('Network idle timeout reached, continuing anyway');
        });
        
        // Wait a bit more for rendering
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if content has changed
        const initialContentLength = await page.evaluate(() => document.body.textContent.length);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const finalContentLength = await page.evaluate(() => document.body.textContent.length);
        
        const contentChanged = Math.abs(finalContentLength - initialContentLength) > 50;
        if (contentChanged) {
          console.log(`Content changed during wait (${initialContentLength} -> ${finalContentLength})`);
          // Wait a bit more for final rendering
          await new Promise(resolve => setTimeout(resolve, 1000));
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
