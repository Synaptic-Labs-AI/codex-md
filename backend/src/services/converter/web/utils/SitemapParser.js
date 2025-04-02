/**
 * Sitemap Parser Module
 * Handles parsing of XML and TXT sitemaps, including sitemap index files
 */

import { parseStringPromise } from 'xml2js';
import { AppError } from '../../../../utils/errorHandler.js';
import got from 'got';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

export class SitemapParser {
  constructor(options = {}) {
    this.options = {
      maxEntries: options.maxEntries || 1000,
      timeout: options.timeout || 30000,
      maxDepth: options.maxDepth || 3,
      ...options
    };
    
    this.processedUrls = new Set();
    this.currentDepth = 0;
  }

  /**
   * Parse robots.txt to find sitemap URLs
   * @param {string} robotsTxtUrl - URL to robots.txt file
   * @returns {Promise<string[]>} Array of sitemap URLs
   */
  async findSitemapsInRobotsTxt(robotsTxtUrl) {
    try {
      const response = await got(robotsTxtUrl, {
        timeout: {
          request: this.options.timeout
        },
        retry: { limit: 2 }
      });

      const sitemapUrls = response.body
        .split('\n')
        .filter(line => line.toLowerCase().startsWith('sitemap:'))
        .map(line => line.split(':')[1].trim());

      return [...new Set(sitemapUrls)];
    } catch (error) {
      console.warn(`Failed to fetch robots.txt from ${robotsTxtUrl}:`, error.message);
      return [];
    }
  }

  /**
   * Parse XML sitemap content
   * @param {string} content - XML content
   * @returns {Promise<Array>} Array of URL objects
   */
  async parseXmlSitemap(content) {
    try {
      const result = await parseStringPromise(content, {
        trim: true,
        explicitArray: false
      });

      // Handle sitemap index
      if (result.sitemapindex) {
        if (this.currentDepth >= this.options.maxDepth) {
          console.warn('Maximum sitemap depth reached, skipping nested sitemaps');
          return [];
        }

        this.currentDepth++;
        const sitemaps = Array.isArray(result.sitemapindex.sitemap)
          ? result.sitemapindex.sitemap
          : [result.sitemapindex.sitemap];

        const nestedUrls = await Promise.all(
          sitemaps.map(sitemap => this.fetchAndParseSitemap(sitemap.loc))
        );

        return nestedUrls.flat();
      }

      // Handle regular sitemap
      if (!result.urlset || !result.urlset.url) {
        return [];
      }

      const urls = Array.isArray(result.urlset.url)
        ? result.urlset.url
        : [result.urlset.url];

      return urls
        .filter(url => url.loc && !this.processedUrls.has(url.loc))
        .map(url => {
          this.processedUrls.add(url.loc);
          return {
            url: url.loc,
            lastmod: url.lastmod || null,
            priority: url.priority ? parseFloat(url.priority) : 0.5,
            changefreq: url.changefreq || null
          };
        })
        .slice(0, this.options.maxEntries);
    } catch (error) {
      console.error('Error parsing XML sitemap:', error);
      throw new AppError(`Failed to parse XML sitemap: ${error.message}`, 500);
    }
  }

  /**
   * Parse TXT sitemap content (one URL per line)
   * @param {string} content - Text content
   * @returns {Array} Array of URL objects
   */
  parseTxtSitemap(content) {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !this.processedUrls.has(line))
      .map(url => {
        this.processedUrls.add(url);
        return {
          url,
          lastmod: null,
          priority: 0.5,
          changefreq: null
        };
      })
      .slice(0, this.options.maxEntries);
  }

  /**
   * Fetch and parse a sitemap from a URL
   * @param {string} url - Sitemap URL
   * @returns {Promise<Array>} Array of URL objects
   */
  async fetchAndParseSitemap(url) {
    try {
      const response = await got(url, {
        timeout: {
          request: this.options.timeout
        },
        retry: { limit: 2 },
        responseType: 'buffer'
      });

      let content = response.body;

      // Handle gzipped content
      if (url.endsWith('.gz') || response.headers['content-encoding'] === 'gzip') {
        try {
          content = await gunzip(content);
        } catch (error) {
          console.warn('Failed to decompress gzipped content:', error);
          // Continue with raw content
        }
      }

      content = content.toString('utf-8');

      // Determine sitemap type and parse accordingly
      if (content.trim().startsWith('<?xml') || content.includes('<urlset') || content.includes('<sitemapindex')) {
        return this.parseXmlSitemap(content);
      } else {
        return this.parseTxtSitemap(content);
      }
    } catch (error) {
      console.error(`Failed to fetch or parse sitemap from ${url}:`, error);
      return [];
    }
  }

  /**
   * Initialize parsing by checking common sitemap locations
   * @param {string} baseUrl - Base URL of the website
   * @param {Object} options - Additional options including onProgress callback
   * @returns {Promise<Array>} Array of URL objects
   */
  async initialize(baseUrl, options = {}) {
    if (!baseUrl.startsWith('http')) {
      baseUrl = `https://${baseUrl}`;
    }

    const urlObj = new URL(baseUrl);
    const domain = urlObj.origin;
    
    // Common sitemap locations to check
    const commonLocations = [
      `${domain}/sitemap.xml`,
      `${domain}/sitemap_index.xml`,
      `${domain}/sitemap.xml.gz`,
      `${domain}/sitemap/sitemap.xml`,
      `${domain}/sitemaps/sitemap.xml`
    ];

    // Also check robots.txt for sitemap declarations
    const robotsTxtUrl = `${domain}/robots.txt`;
    const sitemapsFromRobots = await this.findSitemapsInRobotsTxt(robotsTxtUrl);
    const allLocations = [...commonLocations, ...sitemapsFromRobots];

    // Try each location until we find a valid sitemap
    for (const location of allLocations) {
      try {
        const urls = await this.fetchAndParseSitemap(location);
        if (urls.length > 0) {
          console.log(`✅ Found valid sitemap at ${location} with ${urls.length} URLs`);
          
          // Emit progress event if onProgress callback is provided
          if (options.onProgress) {
            options.onProgress({
              status: 'sitemap_found',
              urlCount: urls.length,
              sitemapUrl: location
            });
          }
          
          return urls;
        }
      } catch (error) {
        console.warn(`No valid sitemap found at ${location}`);
        continue;
      }
    }

    console.log('⚠️ No sitemaps found at common locations');
    return [];
  }
}
