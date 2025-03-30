/**
 * URL Converter Module
 * Handles conversion of single web pages to markdown format
 */

import { AppError } from '../../../utils/errorHandler.js';
import { generateMarkdown } from './utils/htmlToMarkdown.js';
import { BrowserManager } from './utils/BrowserManager.js';
import { PageCleaner } from './utils/PageCleaner.js';
import { ContentExtractor } from './utils/ContentExtractor.js';
import { mergeOptions, generateNameFromUrl } from './utils/converterConfig.js';

export class UrlConverter {
  constructor() {
    this.browserManager = new BrowserManager();
    this.pageCleaner = new PageCleaner();
    this.contentExtractor = new ContentExtractor();
  }

  /**
   * Convert a URL to markdown format
   * @param {string} url - URL to convert
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(url, userOptions = {}) {
    let page = null;
    let browser = null;
    const options = mergeOptions(userOptions);
    
    try {
      // Validate URL
      if (!url) {
        throw new AppError('URL is required', 400);
      }
      
      // Normalize URL with proper error handling
      let normalizedUrl;
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        normalizedUrl = urlObj.toString();
      } catch (error) {
        throw new AppError(`Invalid URL format: ${error.message}`, 400);
      }

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
        await page.goto(normalizedUrl, options.navigation);
      } catch (error) {
        throw new AppError(`Navigation failed: ${error.message}`, 500);
      }

      const finalUrl = page.url();
      
      // Clean up the page
      try {
        await this.pageCleaner.removeOverlays(page);
        await this.pageCleaner.cleanupPage(page);
      } catch (error) {
        console.error('Error cleaning page:', error);
        // Continue with extraction even if cleanup fails
      }
      
      // Check for SPA and wait for dynamic content to load
      await this.contentExtractor.waitForDynamicContent(page);
      
      // Extract content, metadata, and images
      let content = '', metadata = {}, images = [];
      try {
        const extractionResult = await this.contentExtractor.extractContent(
          page,
          finalUrl,
          {
            includeMeta: options.metadata.includeMeta,
            includeImages: options.images.includeImages,
            imageExtensions: options.images.extensions
          }
        );
        
        content = extractionResult.content || '';
        metadata = extractionResult.metadata || {};
        images = extractionResult.images || [];
        
        // Ensure metadata has at least a title
        if (!metadata.title) {
          metadata.title = this.contentExtractor.extractTitleFromUrl(finalUrl);
        }
      } catch (extractionError) {
        console.error('Content extraction failed:', extractionError);
        content = `<html><body><p>Failed to extract content: ${extractionError.message}</p></body></html>`;
        metadata = {
          title: this.contentExtractor.extractTitleFromUrl(finalUrl) || 'Untitled Page',
          source: finalUrl,
          captured: new Date().toISOString()
        };
        images = [];
      }
      
      // Generate markdown
      let markdown = '';
      try {
        console.log('Starting markdown generation...');
        console.log('Content length before cleaning:', content.length);
        
        // Clean content if it's too large
        if (content.length > 1000000) {
          console.log('Content too large, truncating...');
          content = content.substring(0, 1000000);
        }
        
        // Clean content for logging
        const contentPreview = content.substring(0, 200);
        console.log('Content length after cleaning:', content.length);
        console.log('Content preview after cleaning:', contentPreview);
        
        // Ensure metadata is valid
        if (!metadata || typeof metadata !== 'object') {
          console.log('Invalid metadata, creating default metadata');
          metadata = {
            title: this.contentExtractor.extractTitleFromUrl(finalUrl),
            source: finalUrl,
            captured: new Date().toISOString()
          };
        }
        
        markdown = await generateMarkdown(content, metadata, images, finalUrl, options);
      } catch (markdownError) {
        console.error('Error generating Markdown:', markdownError);
        // Create a simple markdown as fallback
        markdown = `# ${metadata && metadata.title ? metadata.title : 'Untitled Page'}\n\n` +
                  `Source: ${finalUrl}\n\n` +
                  `Captured: ${new Date().toISOString()}\n\n` +
                  `Failed to generate Markdown: ${markdownError.message}\n\n`;
        
        throw new AppError(`Failed to generate Markdown: ${markdownError.message}`, 500);
      }
      
      // Generate name from URL
      const name = this.generateName(finalUrl);
      
      return {
        content: markdown,
        name,
        url: finalUrl,
        metadata,
        images,
        success: true
      };

    } catch (error) {
      console.error('URL conversion failed:', error);
      
      // Create a more user-friendly error message
      let errorMessage = 'Failed to convert URL';
      let statusCode = 500;
      
      if (error instanceof AppError) {
        errorMessage = error.message;
        statusCode = error.statusCode;
      } else if (error.name === 'TimeoutError') {
        errorMessage = 'The page took too long to load. Please try again later.';
        statusCode = 408;
      } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = 'The website could not be found. Please check the URL and try again.';
        statusCode = 404;
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = 'The connection to the website was refused. The server might be down.';
        statusCode = 503;
      } else {
        errorMessage = `Failed to convert URL: ${error.message}`;
      }
      
      throw new AppError(errorMessage, statusCode);
    } finally {
      // Clean up resources
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
   * Generate a filename from a URL
   * @param {string} url - URL to generate name from
   * @returns {string} Generated filename
   */
  generateName(url) {
    return generateNameFromUrl(url);
  }
}

// Factory function to create converter
export async function convertUrlToMarkdown(url, options = {}) {
  const converter = new UrlConverter();
  return converter.convertToMarkdown(url, options);
}

// Singleton instance
export const urlConverter = {
  convertToMarkdown: async (url, options = {}) => {
    const converter = new UrlConverter();
    return converter.convertToMarkdown(url, options);
  }
};
