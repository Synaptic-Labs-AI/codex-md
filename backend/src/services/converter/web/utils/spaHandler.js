/**
 * SPA Handler Module
 * 
 * This module provides functionality for detecting and handling Single Page Applications (SPAs).
 * It includes methods for detecting SPAs, handling dynamic content loading, and scoring content quality.
 * 
 * Related files:
 * - ../urlConverter.js: Main URL converter implementation
 * - ./config.js: Configuration settings
 * - ./contentExtractor.js: Content extraction logic
 * - ./htmlToMarkdown.js: HTML to Markdown conversion
 */

import got from 'got';
import * as cheerio from 'cheerio';
import { AppError } from '../../../../utils/errorHandler.js';
import { WAIT_TIMES } from './config.js';

/**
 * Detects if a page is likely a Single Page Application (SPA)
 * @param {string} html - The page HTML
 * @returns {boolean} - True if the page is likely an SPA
 */
export function detectSPA(html) {
  if (!html) return false;
  
  // SPA indicators
  const spaIndicators = [
    // Framework root elements
    /<div[^>]*(?:id=['"]app['"]|id=['"]root['"])/i,
    /<div[^>]*(?:data-reactroot|data-react-app)/i,
    /<div[^>]*(?:ng-app|ng-controller|ng-view)/i,
    /<div[^>]*(?:v-app|data-v-|vue-app)/i,
    /<div[^>]*(?:data-svelte|svelte-app)/i,
    
    // Framework scripts
    /<script[^>]*(?:react|vue|angular|svelte|next|nuxt|gatsby)/i,
    /<script[^>]*(?:webpack|babel|typescript|tsx|jsx)/i,
    
    // Common SPA patterns
    /<div[^>]*(?:router-view|ui-view|page-view)/i,
    /<div[^>]*(?:data-router|data-page|data-view)/i,
    /<meta[^>]*(?:single-page-app|spa)/i,
    
    // Empty content containers that will be filled by JS
    /<div[^>]*(?:id=['"]content['"]|class=['"]content['"])[^>]*>\s*<\/div>/i,
    /<div[^>]*(?:id=['"]main['"]|class=['"]main['"])[^>]*>\s*<\/div>/i,
    /<div[^>]*(?:id=['"]app['"]|class=['"]app['"])[^>]*>\s*<\/div>/i,
    
    // Loading indicators
    /<div[^>]*(?:loading|spinner|skeleton)/i,
    /<div[^>]*(?:data-loading|data-spinner)/i,
    
    // Client-side routing
    /<script[^>]*(?:history|router|route|navigation)/i,
    /<a[^>]*(?:data-navigo|data-router-link)/i,
    
    // State management libraries
    /<script[^>]*(?:redux|mobx|vuex|recoil|jotai|zustand)/i
  ];
  
  // Check if any SPA indicators are present
  const isSPA = spaIndicators.some(pattern => pattern.test(html));
  
  // Also check if the page has minimal content but lots of scripts
  const hasMinimalContent = html.length < 20000 && 
                           (html.match(/<script/g) || []).length > 5;
  
  // Check for large JavaScript bundles
  const hasLargeJSBundles = (html.match(/<script[^>]*src=["'][^"']*\.bundle\.js["']/g) || []).length > 0 ||
                           (html.match(/<script[^>]*src=["'][^"']*\.chunk\.js["']/g) || []).length > 0 ||
                           (html.match(/<script[^>]*src=["'][^"']*\.[0-9a-f]{8}\.js["']/g) || []).length > 0;
  
  return isSPA || hasMinimalContent || hasLargeJSBundles;
}

/**
 * Scores HTML content for quality
 * @param {string} html - The HTML content to score
 * @returns {number} - A quality score (higher is better)
 */
export function scoreContent(html) {
  if (!html) return 0;
  
  try {
    const $ = cheerio.load(html);
    
    // Count paragraphs
    const paragraphCount = $('p').length;
    
    // Count headings
    const headingCount = $('h1, h2, h3, h4, h5, h6').length;
    
    // Count images
    const imageCount = $('img').length;
    
    // Count links
    const linkCount = $('a[href]').length;
    
    // Count words in paragraphs
    let wordCount = 0;
    $('p').each((_, el) => {
      wordCount += $(el).text().trim().split(/\s+/).length;
    });
    
    // Count lists
    const listCount = $('ul, ol').length;
    
    // Count list items
    const listItemCount = $('li').length;
    
    // Count tables
    const tableCount = $('table').length * 20;
    
    // Count code blocks
    const codeBlockCount = $('pre, code').length * 15;
    
    // Count blockquotes
    const blockquoteCount = $('blockquote').length * 10;
    
    // Calculate final score
    const score = paragraphCount * 10 + 
                 headingCount * 15 + 
                 imageCount * 5 + 
                 linkCount * 2 + 
                 wordCount * 0.5 +
                 listCount * 10 +
                 listItemCount * 3 +
                 tableCount +
                 codeBlockCount +
                 blockquoteCount;
    
    return score;
  } catch (error) {
    console.error('Error scoring HTML content:', error);
    return 0;
  }
}

/**
 * Fetches a web page with enhanced handling for dynamic content
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<{html: string, finalUrl: string}>} - The page HTML and final URL
 */
export async function fetchPageWithSPAHandling(url, options) {
  console.log(`📥 Fetching page with SPA handling: ${url}`);
  
  try {
    // Create a clean options object for got
    const gotOptions = {
      headers: options.http.headers,
      timeout: options.http.timeout,
      retry: options.http.retry,
      decompress: options.http.decompress,
      responseType: options.http.responseType,
      followRedirect: true,
      throwHttpErrors: false
    };
    
    // Add a random query parameter to avoid caching
    gotOptions.searchParams = {
      '_': Date.now()
    };
    
    // Fetch the page
    const response = await got(url, gotOptions);
    
    // Check for errors
    if (response.statusCode >= 400) {
      throw new AppError(`Failed to fetch URL: ${response.statusCode}`, 400);
    }
    
    // Get the final URL after any redirects
    const finalUrl = response.url;
    
    // Check if the page is likely a Single Page Application (SPA)
    const isSPA = detectSPA(response.body);
    
    // For SPAs, try multiple wait times to get the best content
    if (options.handleDynamicContent && isSPA) {
      console.log(`🔄 Detected SPA, trying multiple wait times for best content...`);
      
      let bestHtml = response.body;
      let bestContentScore = scoreContent(response.body);
      console.log(`📊 Initial content score: ${bestContentScore}`);
      
      // Try different wait times for dynamic content
      for (const waitTime of WAIT_TIMES) {
        try {
          console.log(`⏱️ Trying with ${waitTime}ms delay...`);
          
          // Add a delay
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Create options with delay and a new cache-busting parameter
          const delayedOptions = { 
            ...gotOptions,
            headers: {
              ...gotOptions.headers,
              'Cookie': `nocache=${Date.now()}`,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            },
            searchParams: {
              '_': Date.now(),
              'nocache': Date.now()
            }
          };
          
          // Fetch again after delay
          const delayedResponse = await got(finalUrl, delayedOptions);
          
          // Score the content quality
          const contentScore = scoreContent(delayedResponse.body);
          console.log(`📊 Content score for ${waitTime}ms delay: ${contentScore}`);
          
          // Keep the response with the highest content score
          if (contentScore > bestContentScore) {
            bestHtml = delayedResponse.body;
            bestContentScore = contentScore;
            console.log(`📈 New best content score: ${bestContentScore}`);
          }
        } catch (e) {
          console.log(`⚠️ Error with ${waitTime}ms delay: ${e.message}`);
        }
      }
      
      return { html: bestHtml, finalUrl };
    }
    
    return { html: response.body, finalUrl };
  } catch (error) {
    throw new AppError(`Failed to fetch page: ${error.message}`, 500);
  }
}

/**
 * Checks if a URL is likely to be a dynamic SPA route
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is likely a dynamic SPA route
 */
export function isDynamicRoute(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Check for hash-based routing
    if (urlObj.hash && urlObj.hash.length > 1 && urlObj.hash !== '#') {
      return true;
    }
    
    // Check for query-based routing
    if (urlObj.search && (
      urlObj.searchParams.has('page') || 
      urlObj.searchParams.has('route') || 
      urlObj.searchParams.has('path') ||
      urlObj.searchParams.has('view')
    )) {
      return true;
    }
    
    // Check for path patterns that suggest dynamic routing
    const dynamicRoutePatterns = [
      /\/[a-f0-9]{8,}$/i, // UUID/hash-like segments
      /\/\d{4}\/\d{2}\/\d{2}\//, // Date patterns
      /\/p\/[^\/]+$/, // Medium-like article paths
      /\/posts?\/[^\/]+$/, // Blog post paths
      /\/articles?\/[^\/]+$/, // Article paths
      /\/products?\/[^\/]+$/, // Product paths
      /\/categories?\/[^\/]+$/, // Category paths
      /\/tags?\/[^\/]+$/, // Tag paths
      /\/users?\/[^\/]+$/, // User paths
      /\/profiles?\/[^\/]+$/, // Profile paths
      /\/events?\/[^\/]+$/, // Event paths
      /\/news\/[^\/]+$/, // News paths
      /\/videos?\/[^\/]+$/, // Video paths
      /\/photos?\/[^\/]+$/, // Photo paths
      /\/images?\/[^\/]+$/, // Image paths
      /\/documents?\/[^\/]+$/, // Document paths
      /\/files?\/[^\/]+$/, // File paths
      /\/download\/[^\/]+$/, // Download paths
      /\/view\/[^\/]+$/, // View paths
      /\/preview\/[^\/]+$/, // Preview paths
      /\/embed\/[^\/]+$/, // Embed paths
      /\/share\/[^\/]+$/, // Share paths
      /\/ref\/[^\/]+$/, // Reference paths
      /\/go\/[^\/]+$/, // Go/redirect paths
      /\/r\/[^\/]+$/, // Reddit-like subreddit paths
      /\/u\/[^\/]+$/, // Reddit-like user paths
      /\/wiki\/[^\/]+$/, // Wiki paths
      /\/search\/[^\/]+$/, // Search paths
      /\/q\/[^\/]+$/, // Query paths
    ];
    
    return dynamicRoutePatterns.some(pattern => pattern.test(path));
  } catch (error) {
    console.error('Error checking dynamic route:', error);
    return false;
  }
}

export default {
  detectSPA,
  scoreContent,
  fetchPageWithSPAHandling,
  isDynamicRoute
};
