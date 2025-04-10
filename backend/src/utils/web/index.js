/**
 * Web Utilities for Backend
 * 
 * This module provides utilities for working with web content,
 * including metadata extraction, content parsing, and link handling.
 * 
 * Used by:
 * - backend/src/utils/metadataExtractor.js
 * - backend/src/services/converter/web/
 */

/**
 * Extract metadata from web content
 * @param {Object} options - Extraction options
 * @param {string} options.html - HTML content
 * @param {string} options.url - Source URL
 * @returns {Object} Extracted metadata
 */
export function extractMetadata({ html, url }) {
  const metadata = {
    source_url: url,
    extracted_date: new Date().toISOString()
  };

  try {
    // Basic metadata extraction from HTML
    if (html) {
      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        metadata.title = titleMatch[1].trim();
      }

      // Extract meta description
      const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
      if (descriptionMatch && descriptionMatch[1]) {
        metadata.description = descriptionMatch[1].trim();
      }

      // Extract meta keywords
      const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["'][^>]*>/i);
      if (keywordsMatch && keywordsMatch[1]) {
        metadata.keywords = keywordsMatch[1].split(',').map(k => k.trim());
      }

      // Extract author
      const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["'][^>]*>/i);
      if (authorMatch && authorMatch[1]) {
        metadata.author = authorMatch[1].trim();
      }
    }

    // Extract domain from URL
    if (url) {
      try {
        const urlObj = new URL(url);
        metadata.domain = urlObj.hostname;
      } catch (e) {
        // Invalid URL, ignore
      }
    }

    return metadata;
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return metadata;
  }
}

/**
 * Extract main content from HTML
 * @param {string} html - HTML content
 * @returns {string} Extracted content
 */
export function extractContent(html) {
  if (!html) return '';

  try {
    // Simple content extraction - remove scripts, styles, and HTML tags
    let content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return content;
  } catch (error) {
    console.error('Error extracting content:', error);
    return '';
  }
}

/**
 * Extract links from HTML
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {Array} Extracted links
 */
export function extractLinks(html, baseUrl) {
  if (!html) return [];

  try {
    const links = [];
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, '').trim();

      // Skip empty or javascript links
      if (!href || href.startsWith('javascript:') || href === '#') {
        continue;
      }

      // Resolve relative URLs if base URL is provided
      let fullUrl = href;
      if (baseUrl && !href.match(/^https?:\/\//i)) {
        try {
          fullUrl = new URL(href, baseUrl).href;
        } catch (e) {
          // Invalid URL, use original
          fullUrl = href;
        }
      }

      links.push({
        url: fullUrl,
        text: text || fullUrl
      });
    }

    return links;
  } catch (error) {
    console.error('Error extracting links:', error);
    return [];
  }
}

export default {
  extractMetadata,
  extractContent,
  extractLinks
};
