import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Extracts metadata from a webpage
 * @param {string} url - URL of the webpage
 * @returns {Promise<object>} - Extracted metadata
 */
export async function extractMetadata(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Base metadata object
    const metadata = {
      title: '',
      description: '',
      author: '',
      date: '',
      source: url,
      site: '',
      captured: new Date().toISOString()
    };

    // Extract title (try multiple sources)
    metadata.title = 
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      new URL(url).hostname;

    // Extract description
    metadata.description = 
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      '';

    // Extract author
    metadata.author = 
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      '';

    // Extract publication date
    metadata.date = 
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="publication_date"]').attr('content') ||
      '';

    // Extract site name
    metadata.site = 
      $('meta[property="og:site_name"]').attr('content') ||
      new URL(url).hostname;

    // Clean up the data
    Object.keys(metadata).forEach(key => {
      if (typeof metadata[key] === 'string') {
        metadata[key] = metadata[key]
          .trim()
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/\s+/g, ' ');
      }
    });

    // Remove empty fields
    Object.keys(metadata).forEach(key => {
      if (metadata[key] === '' || metadata[key] === null || metadata[key] === undefined) {
        delete metadata[key];
      }
    });

    console.log('Extracted metadata:', metadata);
    return metadata;

  } catch (error) {
    console.error('Metadata extraction error:', error);
    // Return basic metadata even if extraction fails
    return {
      title: new URL(url).hostname,
      source: url,
      captured: new Date().toISOString()
    };
  }
}

/**
 * Formats metadata as YAML frontmatter
 * @param {object} metadata - Metadata object
 * @returns {string} - Formatted YAML frontmatter
 */
export function formatMetadata(metadata) {
  const lines = ['---'];

  Object.entries(metadata).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        lines.push(`${key}:`);
        value.forEach(item => lines.push(`  - ${item}`));
      }
    } else if (value !== null && value !== undefined && value !== '') {
      // Escape special characters and wrap in quotes if needed
      const needsQuotes = /[:#\[\]{}",\n]/g.test(value.toString());
      const escapedValue = value.toString().replace(/"/g, '\\"');
      lines.push(`${key}: ${needsQuotes ? `"${escapedValue}"` : value}`);
    }
  });

  lines.push('---', '');
  return lines.join('\n');
}
